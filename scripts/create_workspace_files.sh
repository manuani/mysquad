#!/bin/bash
# Helper to populate consistent workspace files
# Usage: ./create_workspace_files.sh <kind> <name> <description>
# kind = service | package | app
set -e
KIND=$1
NAME=$2
DESC=$3
DIR="/home/claude/voai-platform/${KIND}s/${NAME}"

cat > "$DIR/package.json" << JSON
{
  "name": "@voai/${NAME}",
  "version": "0.0.0",
  "private": true,
  "description": "${DESC}",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -b",
    "dev": "tsc -b -w",
    "lint": "eslint src --ext .ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:unit": "vitest run",
    "clean": "rm -rf dist .turbo *.tsbuildinfo"
  },
  "devDependencies": {
    "typescript": "workspace:*",
    "vitest": "workspace:*"
  }
}
JSON

cat > "$DIR/tsconfig.json" << JSON
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "composite": true
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules", "tests"]
}
JSON
echo "Wrote $DIR"
