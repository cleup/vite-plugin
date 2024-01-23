# Cleup Vite Plugin

Plugin for the correct operation of the Cleup framework

#### Installation
```
npm i cleup-vite-plugin
```

### Configure vite.config.js 
```js
import { defineConfig } from 'vite';
import cleup from 'cleup-vite-plugin';
 
export default defineConfig({
    plugins: [
        cleup([
            'assets/js/app.js'
        ]),
    ],
});
```

### Add to "assets/js/app.js"
```js
import '../styles/main.scss'
// Your application code
// ....
```
