import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import path from "path";
import colors from "picocolors";
import { loadEnv } from "vite";
import fullReload from "vite-plugin-full-reload";
let exitHandlersBound = false;
const refreshPaths = [
    "app/**",
    "languages/**",
    "views/**"
];
function cleup(config) {
    const pluginConfig = resolvePluginConfig(config);
    return [
        resolveCleupPlugin(pluginConfig),
        ...resolveFullReloadConfig(pluginConfig)
    ];
}
function resolveCleupPlugin(pluginConfig) {
    let viteDevServerUrl;
    let resolvedConfig;
    let userConfig;
    const defaultAliases = {
        "@": "/assets/js"
    };
    return {
        name: "cleup",
        enforce: "post",
        config: (config, { command, mode }) => {
            userConfig = config;
            const ssr = !!userConfig.build?.ssr;
            const env = loadEnv(mode, userConfig.envDir || process.cwd(), "");
            const assetUrl = env.ASSET_URL ?? "";
            const serverConfig = command === "serve" ? resolveDevelopmentEnvironmentServerConfig(pluginConfig.detectTls) ?? resolveEnvironmentServerConfig(env) : void 0;
            ensureCommandShouldRunInEnvironment(command, env);
            return {
                base: userConfig.base ?? (command === "build" ? resolveBase(pluginConfig, assetUrl) : ""),
                publicDir: userConfig.publicDir ?? false,
                build: {
                    manifest: userConfig.build?.manifest ?? (ssr ? false : "manifest.json"),
                    ssrManifest: userConfig.build?.ssrManifest ?? (ssr ? "ssr-manifest.json" : false),
                    outDir: userConfig.build?.outDir ?? resolveOutDir(pluginConfig, ssr),
                    rollupOptions: {
                        input: userConfig.build?.rollupOptions?.input ?? resolveInput(pluginConfig, ssr)
                    },
                    assetsInlineLimit: userConfig.build?.assetsInlineLimit ?? 0
                },
                server: {
                    origin: userConfig.server?.origin ?? "__cleup_vite_placeholder__",
                    ...process.env.CLEUP_LOADER ? {
                        host: userConfig.server?.host ?? "0.0.0.0",
                        port: userConfig.server?.port ?? (env.VITE_PORT ? parseInt(env.VITE_PORT) : 5173),
                        strictPort: userConfig.server?.strictPort ?? true
                    } : void 0,
                    ...serverConfig ? {
                        host: userConfig.server?.host ?? serverConfig.host,
                        hmr: userConfig.server?.hmr === false ? false : {
                            ...serverConfig.hmr,
                            ...userConfig.server?.hmr === true ? {} : userConfig.server?.hmr
                        },
                        https: typeof userConfig.server?.https !== "undefined" ? userConfig.server.https : {
                            ...serverConfig.https,
                            ...typeof userConfig.server?.https === "undefined" ? {} : userConfig.server?.https
                        }
                    } : void 0
                },
                resolve: {
                    alias: Array.isArray(userConfig.resolve?.alias) ? [
                        ...userConfig.resolve?.alias ?? [],
                        ...Object.keys(defaultAliases).map((alias) => ({
                            find: alias,
                            replacement: defaultAliases[alias]
                        }))
                    ] : {
                        ...defaultAliases,
                        ...userConfig.resolve?.alias
                    }
                }
            };
        },
        configResolved(config) {
            resolvedConfig = config;
        },
        transform(code) {
            if (resolvedConfig.command === "serve") {
                code = code.replace(/__cleup_vite_placeholder__/g, viteDevServerUrl);
                return pluginConfig.transformOnServe(code, viteDevServerUrl);
            }
        },
        configureServer(server) {
            const envDir = resolvedConfig.envDir || process.cwd();
            const appUrl = loadEnv(resolvedConfig.mode, envDir, "APP_URL").APP_URL ?? "n/a";
            server.httpServer?.once("listening", () => {
                const address = server.httpServer?.address();
                const isAddressInfo = (x) => typeof x === "object";
                if (isAddressInfo(address)) {
                    viteDevServerUrl = userConfig.server?.origin ? userConfig.server.origin : resolveDevServerUrl(address, server.config, userConfig);
                    fs.writeFileSync(pluginConfig.hotFile, viteDevServerUrl);
                    setTimeout(() => {
                        server.config.logger.info(`${colors.green(`${colors.bold("CLEUP")} ${cleupVersion()}`)}  ${colors.dim("plugin")} ${colors.bold(`v${pluginVersion()}`)}`);
                        server.config.logger.info("");
                        server.config.logger.info(`  ${colors.green("\u279C")}  ${colors.bold("APP_URL")}: ${colors.cyan(appUrl.replace(/:(\d+)/, (_, port) => `:${colors.bold(port)}`))}`);
                        if (typeof resolvedConfig.server.https === "object" && typeof resolvedConfig.server.https.key === "string") {
                            if (resolvedConfig.server.https.key.startsWith(herdConfigPath())) {
                                server.config.logger.info(`  ${colors.green("\u279C")}  Using Herd certificate to secure Vite.`);
                            }
                            if (resolvedConfig.server.https.key.startsWith(valetConfigPath())) {
                                server.config.logger.info(`  ${colors.green("\u279C")}  Using Valet certificate to secure Vite.`);
                            }
                        }
                    }, 100);
                }
            });
            if (!exitHandlersBound) {
                const clean = () => {
                    if (fs.existsSync(pluginConfig.hotFile)) {
                        fs.rmSync(pluginConfig.hotFile);
                    }
                };
                process.on("exit", clean);
                process.on("SIGINT", process.exit);
                process.on("SIGTERM", process.exit);
                process.on("SIGHUP", process.exit);
                exitHandlersBound = true;
            }
            return () => server.middlewares.use((req, res, next) => {
                if (req.url === "/index.html") {
                    res.statusCode = 404;
                    res.end(
                        fs.readFileSync(path.join(dirname(), "dev.html")).toString().replace(/{{ APP_URL }}/g, appUrl)
                    );
                }
                next();
            });
        }
    };
}
function ensureCommandShouldRunInEnvironment(command, env) {
    if (command === "build" || env.CLEUP_BYPASS_ENV_CHECK === "1") {
        return;
    }
    if (typeof env.CLEUP_VAPOR !== "undefined") {
        throw Error("You should not run the Vite HMR server on Vapor. You should build your assets for production instead. To disable this ENV check you may set CLEUP_BYPASS_ENV_CHECK=1");
    }
    if (typeof env.CLEUP_FORGE !== "undefined") {
        throw Error("You should not run the Vite HMR server in your Forge deployment script. You should build your assets for production instead. To disable this ENV check you may set CLEUP_BYPASS_ENV_CHECK=1");
    }
    if (typeof env.CLEUP_ENVOYER !== "undefined") {
        throw Error("You should not run the Vite HMR server in your Envoyer hook. You should build your assets for production instead. To disable this ENV check you may set CLEUP_BYPASS_ENV_CHECK=1");
    }
    if (typeof env.CI !== "undefined") {
        throw Error("You should not run the Vite HMR server in CI environments. You should build your assets for production instead. To disable this ENV check you may set CLEUP_BYPASS_ENV_CHECK=1");
    }
}
function cleupVersion() {
    try {
        const composer = JSON.parse(fs.readFileSync("composer.lock").toString());
        return composer.packages?.find((composerPackage) => composerPackage.name === "cleup/cleup-framework")?.version ?? "";
    } catch {
        return "";
    }
}
function pluginVersion() {
    try {
        return JSON.parse(fs.readFileSync(path.join(dirname(), "../package.json")).toString())?.version;
    } catch {
        return "";
    }
}
function resolvePluginConfig(config) {
    if (typeof config === "undefined") {
        throw new Error("cleup-vite-plugin: missing configuration.");
    }
    if (typeof config === "string" || Array.isArray(config)) {
        config = { input: config, ssr: config };
    }
    if (typeof config.input === "undefined") {
        throw new Error('cleup-vite-plugin: missing configuration for "input".');
    }
    if (typeof config.publicDirectory === "string") {
        config.publicDirectory = config.publicDirectory.trim().replace(/^\/+/, "");
        if (config.publicDirectory === "") {
            throw new Error("cleup-vite-plugin: publicDirectory must be a subdirectory. E.g. 'public'.");
        }
    }
    if (typeof config.buildDirectory === "string") {
        config.buildDirectory = config.buildDirectory.trim().replace(/^\/+/, "").replace(/\/+$/, "");
        if (config.buildDirectory === "") {
            throw new Error("cleup-vite-plugin: buildDirectory must be a subdirectory. E.g. 'build'.");
        }
    }
    if (typeof config.ssrOutputDirectory === "string") {
        config.ssrOutputDirectory = config.ssrOutputDirectory.trim().replace(/^\/+/, "").replace(/\/+$/, "");
    }
    if (config.refresh === true) {
        config.refresh = [{ paths: refreshPaths }];
    }
    return {
        input: config.input,
        publicDirectory: config.publicDirectory ?? "public",
        buildDirectory: config.buildDirectory ?? "build",
        ssr: config.ssr ?? config.input,
        ssrOutputDirectory: config.ssrOutputDirectory ?? "bootstrap/ssr",
        refresh: config.refresh ?? false,
        hotFile: config.hotFile ?? path.join(config.publicDirectory ?? "public", "hot"),
        valetTls: config.valetTls ?? null,
        detectTls: config.detectTls ?? config.valetTls ?? null,
        transformOnServe: config.transformOnServe ?? ((code) => code)
    };
}
function resolveBase(config, assetUrl) {
    return assetUrl + (!assetUrl.endsWith("/") ? "/" : "") + config.buildDirectory + "/";
}
function resolveInput(config, ssr) {
    if (ssr) {
        return config.ssr;
    }
    return config.input;
}
function resolveOutDir(config, ssr) {
    if (ssr) {
        return config.ssrOutputDirectory;
    }
    return path.join(config.publicDirectory, config.buildDirectory);
}
function resolveFullReloadConfig({ refresh: config }) {
    if (typeof config === "boolean") {
        return [];
    }
    if (typeof config === "string") {
        config = [{ paths: [config] }];
    }
    if (!Array.isArray(config)) {
        config = [config];
    }
    if (config.some((c) => typeof c === "string")) {
        config = [{ paths: config }];
    }
    return config.flatMap((c) => {
        const plugin = fullReload(c.paths, c.config);
        plugin.__cleup_plugin_config = c;
        return plugin;
    });
}
function resolveDevServerUrl(address, config, userConfig) {
    const configHmrProtocol = typeof config.server.hmr === "object" ? config.server.hmr.protocol : null;
    const clientProtocol = configHmrProtocol ? configHmrProtocol === "wss" ? "https" : "http" : null;
    const serverProtocol = config.server.https ? "https" : "http";
    const protocol = clientProtocol ?? serverProtocol;
    const configHmrHost = typeof config.server.hmr === "object" ? config.server.hmr.host : null;
    const configHost = typeof config.server.host === "string" ? config.server.host : null;
    const serverAddress = isIpv6(address) ? `[${address.address}]` : address.address;
    const host = configHmrHost ?? configHost ?? serverAddress;
    const configHmrClientPort = typeof config.server.hmr === "object" ? config.server.hmr.clientPort : null;
    const port = configHmrClientPort ?? address.port;
    return `${protocol}://${host}:${port}`;
}
function isIpv6(address) {
    return address.family === "IPv6" || address.family === 6;
}
function resolveEnvironmentServerConfig(env) {
    if (!env.VITE_DEV_SERVER_KEY && !env.VITE_DEV_SERVER_CERT) {
        return;
    }
    if (!fs.existsSync(env.VITE_DEV_SERVER_KEY) || !fs.existsSync(env.VITE_DEV_SERVER_CERT)) {
        throw Error(`Unable to find the certificate files specified in your environment. Ensure you have correctly configured VITE_DEV_SERVER_KEY: [${env.VITE_DEV_SERVER_KEY}] and VITE_DEV_SERVER_CERT: [${env.VITE_DEV_SERVER_CERT}].`);
    }
    const host = resolveHostFromEnv(env);
    if (!host) {
        throw Error(`Unable to determine the host from the environment's APP_URL: [${env.APP_URL}].`);
    }
    return {
        hmr: { host },
        host,
        https: {
            key: fs.readFileSync(env.VITE_DEV_SERVER_KEY),
            cert: fs.readFileSync(env.VITE_DEV_SERVER_CERT)
        }
    };
}
function resolveHostFromEnv(env) {
    try {
        return new URL(env.APP_URL).host;
    } catch {
        return;
    }
}
function resolveDevelopmentEnvironmentServerConfig(host) {
    if (host === false) {
        return;
    }
    const configPath = determineDevelopmentEnvironmentConfigPath();
    if (typeof configPath === "undefined" && host === null) {
        return;
    }
    if (typeof configPath === "undefined") {
        throw Error(`Unable to find the Herd or Valet configuration directory. Please check they are correctly installed.`);
    }
    const resolvedHost = host === true || host === null ? path.basename(process.cwd()) + "." + resolveDevelopmentEnvironmentTld(configPath) : host;
    const keyPath = path.resolve(configPath, "Certificates", `${resolvedHost}.key`);
    const certPath = path.resolve(configPath, "Certificates", `${resolvedHost}.crt`);
    if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
        if (host === null) {
            return;
        }
        if (configPath === herdConfigPath()) {
            throw Error(`Unable to find certificate files for your host [${resolvedHost}] in the [${configPath}/Certificates] directory. Ensure you have secured the site via the Herd UI.`);
        } else if (typeof host === "string") {
            throw Error(`Unable to find certificate files for your host [${resolvedHost}] in the [${configPath}/Certificates] directory. Ensure you have secured the site by running \`valet secure ${host}\`.`);
        } else {
            throw Error(`Unable to find certificate files for your host [${resolvedHost}] in the [${configPath}/Certificates] directory. Ensure you have secured the site by running \`valet secure\`.`);
        }
    }
    return {
        hmr: { host: resolvedHost },
        host: resolvedHost,
        https: {
            key: keyPath,
            cert: certPath
        }
    };
}
function determineDevelopmentEnvironmentConfigPath() {
    if (fs.existsSync(herdConfigPath())) {
        return herdConfigPath();
    }
    if (fs.existsSync(valetConfigPath())) {
        return valetConfigPath();
    }
}
function resolveDevelopmentEnvironmentTld(configPath) {
    const configFile = path.resolve(configPath, "config.json");
    if (!fs.existsSync(configFile)) {
        throw Error(`Unable to find the configuration file [${configFile}].`);
    }
    const config = JSON.parse(fs.readFileSync(configFile, "utf-8"));
    return config.tld;
}
function dirname() {
    return fileURLToPath(new URL(".", import.meta.url));
}
function herdConfigPath() {
    return path.resolve(os.homedir(), "Library", "Application Support", "Herd", "config", "valet");
}
function valetConfigPath() {
    return path.resolve(os.homedir(), ".config", "valet");
}
export {
    cleup as default,
    refreshPaths
};
