import { defineConfig } from 'vite'

export default defineConfig({
  server: { port: 8080, host: true },
  esbuild: {
    jsx: 'classic',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    jsxInject: `import * as React from 'react'`
  }
})
