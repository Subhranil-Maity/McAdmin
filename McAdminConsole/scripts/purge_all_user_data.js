import { createClerkClient } from '@clerk/backend';
import readline from 'readline';
import fs from 'fs';
import path from 'path';

// If CLERK_SECRET_KEY is not in process.env, load from .env.local or .env
if (!process.env.CLERK_SECRET_KEY) {
  const possibleEnvFiles = ['.env.local', '.env'];
  for (const file of possibleEnvFiles) {
    try {
      const envPath = path.resolve(process.cwd(), file);
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        for (const line of content.split('\n')) {
          const match = line.match(/^\s*CLERK_SECRET_KEY\s*=\s*(.*)\s*$/);
          if (match) {
            process.env.CLERK_SECRET_KEY = match[1].replace(/^["']|["']$/g, '').trim();
            break;
          }
        }
      }
      if (process.env.CLERK_SECRET_KEY) break;
    } catch {}
  }
}

if (!process.env.CLERK_SECRET_KEY) {
  console.error("Error: CLERK_SECRET_KEY is missing from environment and .env files.");
  process.exit(1);
}

const clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function askQuestion(query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function purgeAllUserMetadata() {
  let limit = 100; // Clerk's max page limit
  let offset = 0;
  let keepGoing = true;

  console.log("\nStarting full metadata purge...");

  while (keepGoing) {
    // 1. Fetch a page of users
    const users = await clerkClient.users.getUserList({
      limit,
      offset,
    });

    if (users.data.length === 0) {
      keepGoing = false;
      break;
    }

    // 2. Loop through each user and replace metadata with empty objects
    for (const user of users.data) {
      try {
        await clerkClient.users.replaceUserMetadata(user.id, {
          publicMetadata: {},
          privateMetadata: {},
          unsafeMetadata: {},
        });
        console.log(`Successfully purged metadata for user: ${user.id}`);
      } catch (error) {
        console.error(`Failed to purge metadata for user ${user.id}:`, error);
      }
    }

    // Move to the next page
    offset += limit;
  }

  console.log("\nFinished purging all user metadata!");
}

async function main() {
  console.log("\n==================================================");
  console.log("⚠️   DANGER: CLERK USER METADATA PURGE TOOL   ⚠️");
  console.log("==================================================");
  console.log("This action will permanently purge ALL public, private, and unsafe");
  console.log("metadata (including assigned user roles) across ALL registered users.");
  console.log("==================================================\n");

  const answer = await askQuestion(
    "Are you sure you really want to do that? (type 'yes' to proceed): "
  );

  if (answer.trim().toLowerCase() !== "yes") {
    console.log("\nOperation cancelled. No changes were made.\n");
    rl.close();
    process.exit(0);
  }

  rl.close();

  try {
    await purgeAllUserMetadata();
  } catch (err) {
    console.error("Fatal error during purge:", err);
    process.exit(1);
  }
}

main();
