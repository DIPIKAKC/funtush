import { defineConfig } from 'vitest/config'
import dotenv from 'dotenv'

// Load .env.test file
dotenv.config({ path: '.env.test' })

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      DATABASE_URL: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/funtush_test'
    }
  }
})