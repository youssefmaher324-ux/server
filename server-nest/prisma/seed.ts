const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");

const prisma = new PrismaClient();

async function main() {

  console.log("🌱 Starting seed...");


  const adminPassword = await bcrypt.hash(
    "Admin@123456",
    12
  );


  const admin = await prisma.user.upsert({
    where: {
      email: "admin@citrine.com"
    },
    update: {},
    create: {
      email: "admin@citrine.com",
      password: adminPassword,
      role: "ADMIN",
      name: "Citrine Admin"
    }
  });


  console.log("✅ Admin created:");
  console.log(admin.email);

}


main()
.then(async()=>{
  await prisma.$disconnect();
})
.catch(async(e)=>{
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});