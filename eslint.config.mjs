import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),

  /*
    The write-path boundary (invariant 1, enforced at build time).

    Components and routes (everything under src/app) must not touch the
    database directly. They read through @/lib/queries and write through
    mutate() in @/lib/mutate. Importing the Prisma client — or instantiating
    one — anywhere in app code is a build-failing error, so the runtime guard
    can never be sidestepped by a component reaching past it.
  */
  {
    files: ["src/app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/prisma",
              message:
                "Do not import the Prisma client in components or routes. Read via @/lib/queries; write via mutate() in @/lib/mutate.",
            },
            {
              name: "@prisma/client",
              message:
                "Do not import @prisma/client in components or routes. Database access belongs in @/lib.",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
