import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ROLES = ['super_admin', 'admin', 'employee', 'driver', 'customer'];

const PERMISSIONS = [
  'products.read', 'products.write',
  'categories.write',
  'orders.read', 'orders.write', 'orders.cancel', 'orders.assign_driver',
  'coupons.write',
  'invoices.read', 'invoices.write',
  'drivers.write', 'drivers.update_location',
  'users.manage',
  'audit_logs.read',
  'settings.write',
];

// Which roles get which permissions. super_admin implicitly gets everything
// via the RolesGuard's role-name check, but is listed explicitly too so
// permission-based checks (@RequirePermissions) work the same way.
const ROLE_PERMISSIONS: Record<string, string[]> = {
  super_admin: PERMISSIONS,
  admin: PERMISSIONS,
  employee: ['products.read', 'orders.read', 'orders.write', 'orders.assign_driver', 'invoices.read', 'invoices.write'],
  driver: ['orders.read', 'drivers.update_location'],
  customer: ['orders.read'],
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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
