// Minimal Hardhat config used only to warm the compiler binary cache in CI.
// The actual compilation uses createHardhatRuntimeEnvironment programmatically
// in src/compiler.ts — this config is not loaded at runtime.
import { defineConfig } from 'hardhat/config';

export default defineConfig({
  solidity: '0.8.28',
  paths: {
    sources: './test/fixtures',
  },
});
