import { defineConfig } from 'tsdown'

const PACKAGE_NAME = '@wang291010/dsh-usage-stats'

function inlineDshClientCss() {
  return {
    name: 'inline-dsh-client-css',
    generateBundle: {
      order: 'post' as const,
      handler(_options: unknown, bundle: Record<string, any>) {
        const cssEntries = Object.entries(bundle).filter(([fileName, output]) =>
          fileName.endsWith('.css') && output.type === 'asset')
        if (cssEntries.length === 0) return

        const client = Object.values(bundle).find((output: any) =>
          output.type === 'chunk' && output.fileName === 'client.js')
        if (client === undefined) throw new Error('client.js was not generated')

        const css = cssEntries.map(([, output]: any) =>
          typeof output.source === 'string'
            ? output.source
            : Buffer.from(output.source).toString('utf8')).join('\n')
        const tagId = `${PACKAGE_NAME}/card.module.css`
        const injection = `(()=>{const id=${JSON.stringify(tagId)};if(typeof document!=="undefined"&&!document.querySelector("style[data-plugin-css="+JSON.stringify(id)+"]")){const tag=document.createElement("style");tag.dataset.plugin=${JSON.stringify(PACKAGE_NAME)};tag.dataset.pluginCss=id;tag.textContent=${JSON.stringify(css)};document.head.appendChild(tag)}})();\n`
        client.code = injection + client.code
        if (client.map?.mappings !== undefined) client.map.mappings = `;${client.map.mappings}`

        for (const [fileName] of cssEntries) delete bundle[fileName]
      },
    },
  }
}

export default defineConfig([
  {
    name: PACKAGE_NAME,
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: false,
  },
  {
    name: `${PACKAGE_NAME}/client`,
    entry: { client: 'src/client/index.ts' },
    tsconfig: 'tsconfig.client.json',
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: false,
    css: { minify: true },
    plugins: [inlineDshClientCss()],
    external: [
      'react',
      'react/jsx-runtime',
      'react-dom',
      'react-dom/client',
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-client-runtime/client',
      '@deepseek-ai/dsh-client-ui-slots',
      '@deepseek-ai/dsh-client-web-react',
      '@deepseek-ai/dsh-client-ui-primitives',
    ],
    noExternal: (id: string) => id.startsWith('@deepseek-ai/') ? undefined : true,
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_NAME)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
