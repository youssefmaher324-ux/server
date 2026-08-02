import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'ChangeMe123!';

const ROLES = ['super_admin', 'booking_manager', 'user'];

const PERMISSIONS = [
  'rooms.read',
  'rooms.write',
  'bookings.read',
  'bookings.manage', // approve/reject/reassign/checkin/checkout/message
  'news.write',
  'users.manage',
  'audit_logs.read',
  'settings.write',
];

// Which roles get which permissions. super_admin implicitly gets everything
// via the RolesGuard's role-name check, but is listed explicitly too so
// permission-based checks (@RequirePermissions) work the same way.
const ROLE_PERMISSIONS: Record<string, string[]> = {
  super_admin: PERMISSIONS,
  booking_manager: ['rooms.read', 'bookings.read', 'bookings.manage'],
  user: ['bookings.read'],
};

async function main() {
  const roleRecords: Record<string, string> = {};
  for (const name of ROLES) {
    const role = await prisma.role.upsert({ where: { name }, update: {}, create: { name } });
    roleRecords[name] = role.id;
  }

  const permissionRecords: Record<string, string> = {};
  for (const key of PERMISSIONS) {
    const permission = await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
    permissionRecords[key] = permission.id;
  }

  for (const [roleName, keys] of Object.entries(ROLE_PERMISSIONS)) {
    for (const key of keys) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: roleRecords[roleName], permissionId: permissionRecords[key] } },
        update: {},
        create: { roleId: roleRecords[roleName], permissionId: permissionRecords[key] },
      });
    }
  }

  console.log('Seeded roles and permissions.');

  // ---- Demo login accounts --------------------------------------------------
  // ⚠️ CHANGE THESE PASSWORDS before going to production. They exist so the
  // system is immediately logged-into-able after a fresh `prisma db seed`,
  // not as real production credentials.
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  await prisma.user.upsert({
    where: { email: 'superadmin@monastery.local' },
    update: {},
    create: {
      name: 'Super Admin',
      email: 'superadmin@monastery.local',
      passwordHash,
      roleId: roleRecords['super_admin'],
      isEmailVerified: true,
    },
  });

  await prisma.user.upsert({
    where: { email: 'booking.manager@monastery.local' },
    update: {},
    create: {
      name: 'Booking Manager',
      email: 'booking.manager@monastery.local',
      passwordHash,
      roleId: roleRecords['booking_manager'],
      isEmailVerified: true,
    },
  });

  await prisma.user.upsert({
    where: { email: 'user@monastery.local' },
    update: {},
    create: {
      name: 'Demo User',
      email: 'user@monastery.local',
      passwordHash,
      roleId: roleRecords['user'],
      isEmailVerified: true,
    },
  });

  console.log('Seeded demo accounts:');
  console.log('  superadmin@monastery.local       / ChangeMe123!  (POST /api/auth/login)');
  console.log('  booking.manager@monastery.local  / ChangeMe123!  (POST /api/auth/login)');
  console.log('  user@monastery.local             / ChangeMe123!  (POST /api/auth/login)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
