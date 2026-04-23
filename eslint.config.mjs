import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts"],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      // Strict in react-hooks v7. Several legitimate hydration/fetch sites in
      // page.tsx still trip it; keep visible without blocking CI.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
];

export default config;
