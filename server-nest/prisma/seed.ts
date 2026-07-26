const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");

const prisma = new PrismaClient();

const ROLES = [
  "super_admin",
  "admin",
  "employee",
  "driver",
  "customer"
];

const PERMISSIONS = [
  "products.read",
  "products.write",
  "categories.write",
  "orders.read",
  "orders.write",
  "orders.cancel",
  "orders.assign_driver",
  "coupons.write",
  "invoices.read",
  "invoices.write",
  "drivers.write",
  "drivers.update_location",
  "users.manage",
  "audit_logs.read",
  "settings.write"
];

const ROLE_PERMISSIONS = {
  super_admin: PERMISSIONS,
  admin: PERMISSIONS,

  employee: [
    "products.read",
    "orders.read",
    "orders.write",
    "orders.assign_driver",
    "invoices.read",
    "invoices.write"
  ],

  driver: [
    "orders.read",
    "drivers.update_location"
  ],

  customer: [
    "orders.read"
  ]
};


async function main(){

  console.log("Creating roles...");

  const roleIds = {};

  for(const name of ROLES){

    const role = await prisma.role.upsert({
      where:{
        name
      },
      update:{},
      create:{
        name
      }
    });

    roleIds[name]=role.id;
  }


  console.log("Creating permissions...");

  const permissionIds={};


  for(const key of PERMISSIONS){

    const permission =
      await prisma.permission.upsert({

        where:{
          key
        },

        update:{},

        create:{
          key
        }

      });


    permissionIds[key]=permission.id;
  }



  console.log("Connecting roles...");


  for(const roleName in ROLE_PERMISSIONS){

    for(const permission of ROLE_PERMISSIONS[roleName]){

      await prisma.rolePermission.upsert({

        where:{
          roleId_permissionId:{
            roleId: roleIds[roleName],
            permissionId: permissionIds[permission]
          }
        },

        update:{},

        create:{
          roleId: roleIds[roleName],
          permissionId: permissionIds[permission]
        }

      });

    }

  }



  console.log("Creating admin user...");


  const adminRole =
    await prisma.role.findUnique({
      where:{
        name:"super_admin"
      }
    });



  const password =
    await bcrypt.hash(
      "Admin@123456",
      12
    );



  const admin =
    await prisma.user.upsert({

      where:{
        email:"admin@citrine.com"
      },

      update:{},

      create:{

        email:"admin@citrine.com",

        password,

        name:"Citrine Super Admin",

        roleId:adminRole.id

      }

    });



  console.log("--------------------------------");
  console.log("ADMIN CREATED");
  console.log("Email: admin@citrine.com");
  console.log("Password: Admin@123456");
  console.log("--------------------------------");


}


main()

.catch(e=>{

 console.error(e);

 process.exit(1);

})

.finally(async()=>{

 await prisma.$disconnect();

});