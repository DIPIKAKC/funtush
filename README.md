# Auth Package

A reusable authentication utility module for Node.js + TypeScript applications, handling password hashing, JWT token generation, and token verification.

## Features

- JWT Access Token (15 min expiry)
- JWT Refresh Token (7 days expiry)
- JWT verification
- Password hashing with bcrypt
- Password comparison utility
- Type-safe with TypeScript


## Installation

```bash
npm install bcrypt jsonwebtoken
```

## Environment Variables

Create a `.env` file : [text](apps/api/.env)

```env
JWT_ACCESS_SECRET=your_access_secret
JWT_REFRESH_SECRET=your_refresh_secret
```

## Project Structure

```
packages/auth/
├── index.ts
├── jwt.ts
├── middleware.ts
├── otp.ts
├── password.ts
└── types.ts
```

## Tech Stack

- Node.js
- TypeScript
- bcrypt
- jsonwebtoken