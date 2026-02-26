/**
 * Type declarations for the Service Worker build context.
 *
 * Vite raw imports: `import foo from "./file.js?raw"` resolves to a string.
 * Since the SW tsconfig doesn't include vite-env.d.ts, declare the module
 * pattern here.
 */

declare module "*.js?raw" {
  const content: string;
  export default content;
}
