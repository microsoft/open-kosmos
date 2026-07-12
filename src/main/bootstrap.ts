/**
 * Bootstrap - Main Process Entry Point
 *
 * This file is the entry point for the main process (configured in
 * webpack.main.config.js and electron.vite.config.ts).
 *
 * ============================================================================
 * IMPORT ORDER IS LOAD-BEARING — DO NOT REORDER
 * ============================================================================
 *
 * `./bootstrapUserData` configures app.setName() / app.setPath('userData', ...)
 * and MUST be imported BEFORE `./main`. ES modules evaluate imports in source
 * order, before the importer's own body, and `./main` reads
 * app.getPath('userData') at load time (module-level singletons, ElectronApp
 * instantiation). Under the Vite/Rolldown dev bundle the entire `./main` graph
 * is inlined and evaluated ahead of any code that lives in THIS file's body, so
 * the userData setup had to be moved into a dedicated module to guarantee it
 * runs first. See src/main/bootstrapUserData.ts for the full rationale.
 *
 * Keep these as static side-effect imports (no dynamic import) — the repo's
 * check-mixed-imports guard forbids mixing static and dynamic import() for the
 * same module, and static import is what gives us the ordering guarantee.
 */

// Stage 1: brand-specific userData path setup (must run before anything reads userData).
import './bootstrapUserData';

// Stage 2: the original main entry point.
import './main';
