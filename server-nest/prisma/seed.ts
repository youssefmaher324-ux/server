const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");

const prisma = new PrismaClient();


async function main() {

  console.log("Starting seed...");


  const superAdminRole = await prisma.role.upsert({
    where:{
      name:"super_admin"
    },
    update:{},
    create:{
      name:"super_admin"
    }
  });


  const adminRole = await prisma.role.upsert({
    where:{
      name:"admin"
    },
    update:{},
    create:{
      name:"admin"
    }
  });


  const permissions = [
    "products.read",
    "products.write",
    "orders.read",
    "orders.write",
    "orders.cancel",
    "users.manage",
    "settings.write"
  ];


  for(const key of permissions){

    await prisma.permission.upsert({

      where:{
        key
      },

      update:{},

      create:{
        key
      }

    });

  }


  const password = await bcrypt.hash(
    "Admin@123456",
    12
  );


  const user = await prisma.user.upsert({

    where:{
      email:"admin@citrine.com"
    },

    update:{},

    create:{

      email:"admin@citrine.com",

      password,

      name:"Citrine Admin",

      roleId:superAdminRole.id

    }

  });


  console.log("==============================");
  console.log("ADMIN CREATED");
  console.log("Email: admin@citrine.com");
  console.log("Password: Admin@123456");
  console.log("==============================");

}


main()

.catch((e)=>{

 console.error(e);

 process.exit(1);

})

.finally(async()=>{

 await prisma.$disconnect();

});