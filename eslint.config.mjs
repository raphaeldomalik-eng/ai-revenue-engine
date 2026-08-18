import { globalIgnores } from "eslint/config";

// Next 15's shareable config is legacy-shaped and is not flat-config iterable.
// Keep this foundation gate dependency-light until a dedicated lint policy is added.
export default [globalIgnores([".next/**", "node_modules/**"] )];
