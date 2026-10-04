/// <reference types="vite/client" />

// typescript 7 stops tolerating an undeclared side-effect import, so a Vite lab
// without this file fails with TS2882 on `import './style.css'`. See the master
// template, section 6.2.
declare module '*.pem?raw' {
  const content: string
  export default content
}
