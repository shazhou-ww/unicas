import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, test } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const PACKAGES_DIR = join(ROOT, "packages");
const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/;
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", ".wrangler"]);
const FORBIDDEN_STANDALONE_PATHS = ["unicas-packages/", "stacks/unidocs-"];

function walk(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath, files);
    else if (SOURCE_EXTENSION.test(entry.name)) files.push(fullPath);
  }
  return files;
}

function moduleSpecifiers(filePath) {
  const source = ts.createSourceFile(
    filePath,
    readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const specifiers = [];

  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression
      && ts.isStringLiteralLike(node.moduleReference.expression)) {
      specifiers.push(node.moduleReference.expression.text);
    } else if (ts.isCallExpression(node)
      && node.arguments.length === 1
      && ts.isStringLiteralLike(node.arguments[0])
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === "require")
        || (ts.isPropertyAccessExpression(node.expression)
          && node.expression.name.text === "resolve"
          && ((ts.isMetaProperty(node.expression.expression)
            && node.expression.expression.keywordToken === ts.SyntaxKind.ImportKeyword)
            || (ts.isIdentifier(node.expression.expression)
              && node.expression.expression.text === "require"))))) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return specifiers;
}

function barePackageName(specifier) {
  return specifier.split("/").slice(0, 2).join("/");
}

function declaredDependencies(packageJson, fields) {
  return new Set(fields.flatMap((field) => Object.keys(packageJson[field] ?? {})));
}

function loadPackage(directoryName) {
  const directory = join(PACKAGES_DIR, directoryName);
  const packageJson = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  const runtimeDependencies = declaredDependencies(packageJson, [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
  ]);
  const developmentDependencies = declaredDependencies(packageJson, ["devDependencies"]);
  const runtimeImports = new Set();
  const developmentImports = new Set();
  const escapedRelativeImports = [];

  for (const filePath of walk(directory)) {
    const relativePath = relative(directory, filePath).replace(/\\/g, "/");
    const target = relativePath.startsWith("src/") ? runtimeImports : developmentImports;
    for (const specifier of moduleSpecifiers(filePath)) {
      if (specifier.startsWith("@unicas/") || specifier.startsWith("@unidocs/")) {
        target.add(barePackageName(specifier));
      }
      if (specifier.startsWith(".")) {
        const resolvedImport = resolve(dirname(filePath), specifier);
        const relativeImport = relative(directory, resolvedImport);
        if (relativeImport === ".." || relativeImport.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
          escapedRelativeImports.push(`${relativePath}: ${specifier}`);
        }
      }
    }
  }

  return {
    directory,
    directoryName,
    packageJson,
    runtimeDependencies,
    developmentDependencies,
    runtimeImports,
    developmentImports,
    escapedRelativeImports,
  };
}

function loadTsconfigReferences(pkg) {
  const tsconfigPath = join(pkg.directory, "tsconfig.json");
  if (!existsSync(tsconfigPath)) return null;
  const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf8"));
  if (tsconfig.compilerOptions?.composite !== true) return null;

  return new Set((tsconfig.references ?? []).map((reference) => {
    const referencedPackage = JSON.parse(readFileSync(
      join(resolve(pkg.directory, reference.path), "package.json"),
      "utf8",
    ));
    return referencedPackage.name;
  }));
}

const packages = readdirSync(PACKAGES_DIR)
  .filter((directoryName) => statSync(join(PACKAGES_DIR, directoryName)).isDirectory()
    && existsSync(join(PACKAGES_DIR, directoryName, "package.json")))
  .sort()
  .map(loadPackage);

describe("standalone workspace boundaries", () => {
  test("removed monorepo package directory does not exist", () => {
    expect(existsSync(join(ROOT, "unicas-packages"))).toBe(false);
  });

  test.each(packages.map((pkg) => [pkg.packageJson.name, pkg]))(
    "%s directory matches its package name",
    (_name, pkg) => {
      expect(pkg.packageJson.name).toBe(`@unicas/${pkg.directoryName}`);
    },
  );

  test.each(packages.map((pkg) => [pkg.packageJson.name, pkg]))(
    "%s declares every runtime workspace import",
    (_name, pkg) => {
      const missing = [...pkg.runtimeImports]
        .filter((dependency) => dependency.startsWith("@unicas/") && !pkg.runtimeDependencies.has(dependency))
        .sort();
      expect(missing, `runtime imports missing from dependencies: ${missing.join(", ")}`).toEqual([]);
    },
  );

  test.each(packages.map((pkg) => [pkg.packageJson.name, pkg]))(
    "%s declares every development workspace import",
    (_name, pkg) => {
      const known = new Set([...pkg.runtimeDependencies, ...pkg.developmentDependencies]);
      const missing = [...pkg.developmentImports]
        .filter((dependency) => dependency.startsWith("@unicas/") && !known.has(dependency))
        .sort();
      expect(missing, `development imports missing from dependencies: ${missing.join(", ")}`).toEqual([]);
    },
  );

  test.each(packages.map((pkg) => [pkg.packageJson.name, pkg]))(
    "%s uses every declared workspace dependency",
    (_name, pkg) => {
      const declared = [...pkg.runtimeDependencies, ...pkg.developmentDependencies]
        .filter((dependency) => dependency.startsWith("@unicas/"));
      const imported = new Set([...pkg.runtimeImports, ...pkg.developmentImports]);
      const unused = declared.filter((dependency) => !imported.has(dependency)).sort();
      expect(unused, `declared but not imported: ${unused.join(", ")}`).toEqual([]);
    },
  );

  test.each(packages.map((pkg) => [pkg.packageJson.name, pkg]))(
    "%s TypeScript references cover workspace dependencies",
    (_name, pkg) => {
      const references = loadTsconfigReferences(pkg);
      if (references === null) return;
      const runtimeWorkspaceDependencies = [...pkg.runtimeDependencies]
        .filter((dependency) => dependency.startsWith("@unicas/"));
      const knownWorkspaceDependencies = new Set([
        ...runtimeWorkspaceDependencies,
        ...[...pkg.developmentDependencies].filter((dependency) => dependency.startsWith("@unicas/")),
      ]);
      expect(runtimeWorkspaceDependencies.filter((dependency) => !references.has(dependency)).sort())
        .toEqual([]);
      expect([...references].filter((dependency) => !knownWorkspaceDependencies.has(dependency)).sort())
        .toEqual([]);
    },
  );

  test("root TypeScript references cover every workspace package", () => {
    const rootTsconfig = JSON.parse(readFileSync(join(ROOT, "tsconfig.json"), "utf8"));
    const referencedDirectories = (rootTsconfig.references ?? [])
      .map((reference) => relative(PACKAGES_DIR, resolve(ROOT, reference.path)).replace(/\\/g, "/"))
      .sort();
    expect(referencedDirectories).toEqual(packages.map((pkg) => pkg.directoryName));
  });

  test("repository source and configuration do not reference removed monorepo paths", () => {
    const checkedRoots = [
      join(ROOT, ".agents"),
      join(ROOT, ".github"),
      join(ROOT, "docs"),
      join(ROOT, "packages"),
      join(ROOT, "scripts"),
      join(ROOT, "stacks"),
      join(ROOT, "README.md"),
      join(ROOT, "GLOSSARY.md"),
      join(ROOT, "package.json"),
      join(ROOT, "pnpm-workspace.yaml"),
      join(ROOT, "tsconfig.json"),
    ];
    const files = checkedRoots.flatMap((path) => statSync(path).isDirectory() ? walkAllText(path) : [path]);
    const violations = [];
    for (const filePath of files) {
      const content = readFileSync(filePath, "utf8");
      for (const forbiddenPath of FORBIDDEN_STANDALONE_PATHS) {
        if (content.includes(forbiddenPath)) {
          violations.push(`${relative(ROOT, filePath).replace(/\\/g, "/")}: ${forbiddenPath}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test.each(packages.map((pkg) => [pkg.packageJson.name, pkg]))(
    "%s has no UniDocs dependency or cross-package relative import",
    (_name, pkg) => {
      const allDependencies = declaredDependencies(pkg.packageJson, [
        "dependencies",
        "devDependencies",
        "optionalDependencies",
        "peerDependencies",
      ]);
      const allImports = new Set([...pkg.runtimeImports, ...pkg.developmentImports]);
      expect([...allDependencies].filter((dependency) => dependency.startsWith("@unidocs/")).sort())
        .toEqual([]);
      expect([...allImports].filter((dependency) => dependency.startsWith("@unidocs/")).sort())
        .toEqual([]);
      expect(pkg.escapedRelativeImports).toEqual([]);
    },
  );
});

function walkAllText(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) walkAllText(fullPath, files);
    else if (!entry.name.endsWith(".png") && !entry.name.endsWith(".ico")) files.push(fullPath);
  }
  return files;
}