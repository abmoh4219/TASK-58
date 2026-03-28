const { createHash } = require('node:crypto');

const argon2 = require('argon2');
const { PrismaClient, UserStatus } = require('./generated');

const prisma = new PrismaClient();

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function boolFromEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const normalized = String(value).toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

async function hashPassword(password) {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1
  });
}

async function ensureRole(code, name, description) {
  return prisma.role.upsert({
    where: { code },
    update: { name, description },
    create: { code, name, description }
  });
}

async function ensureUser({ username, email, displayName, password }) {
  const normalizedUsername = username.trim().toLowerCase();
  const normalizedEmail = email.trim().toLowerCase();
  const emailHash = sha256(normalizedEmail);
  const passwordHash = await hashPassword(password);

  const existing = await prisma.user.findFirst({
    where: {
      OR: [{ username: normalizedUsername }, { emailHash }]
    },
    select: { id: true }
  });

  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        username: normalizedUsername,
        displayName,
        emailHash,
        passwordHash,
        consentGranted: true,
        consentGrantedAt: new Date(),
        status: UserStatus.ACTIVE,
        failedLoginAttempts: 0,
        lockedUntil: null
      }
    });
  }

  return prisma.user.create({
    data: {
      username: normalizedUsername,
      displayName,
      emailHash,
      passwordHash,
      consentGranted: true,
      consentGrantedAt: new Date(),
      status: UserStatus.ACTIVE,
      failedLoginAttempts: 0,
      lockedUntil: null
    }
  });
}

async function ensureUserRole(userId, roleId) {
  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId,
        roleId
      }
    },
    update: {},
    create: {
      userId,
      roleId
    }
  });
}

async function run() {
  const adminEmail = process.env.QA_ADMIN_EMAIL || 'qa.admin@culinary.local';
  const adminPassword = process.env.QA_ADMIN_PASSWORD || 'QaAdminPass123!';
  const memberEmail = process.env.QA_MEMBER_EMAIL || 'qa.member@culinary.local';
  const memberPassword = process.env.QA_MEMBER_PASSWORD || 'QaMemberPass123!';
  const grantMemberAdminRole = boolFromEnv('QA_ADMIN_ALSO_MEMBER', true);

  const [adminRole, userRole, memberRole] = await Promise.all([
    ensureRole('ADMIN', 'Administrator', 'Platform administrator'),
    ensureRole('USER', 'User', 'Standard authenticated user'),
    ensureRole('MEMBER', 'Member', 'Paid membership user')
  ]);

  const adminUser = await ensureUser({
    username: adminEmail,
    email: adminEmail,
    displayName: 'QA Admin',
    password: adminPassword
  });

  const memberUser = await ensureUser({
    username: memberEmail,
    email: memberEmail,
    displayName: 'QA Member',
    password: memberPassword
  });

  await ensureUserRole(adminUser.id, adminRole.id);
  await ensureUserRole(adminUser.id, userRole.id);
  if (grantMemberAdminRole) {
    await ensureUserRole(adminUser.id, memberRole.id);
  }

  await ensureUserRole(memberUser.id, userRole.id);
  await ensureUserRole(memberUser.id, memberRole.id);

  console.log('[seed.qa] Seed complete');
  console.log(`[seed.qa] Admin username/email: ${adminEmail}`);
  console.log(`[seed.qa] Admin password: ${adminPassword}`);
  console.log(`[seed.qa] Member username/email: ${memberEmail}`);
  console.log(`[seed.qa] Member password: ${memberPassword}`);
}

run()
  .catch((error) => {
    console.error('[seed.qa] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
