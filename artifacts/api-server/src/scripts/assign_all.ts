import { db, labs, labMembers, users } from "@workspace/db";
import { eq } from "drizzle-orm";

async function run() {
  const allUsers = await db.select().from(users);
  if (!allUsers.length) {
    console.error("No users found in database");
    process.exit(1);
  }

  let [lab] = await db.select().from(labs).limit(1);
  if (!lab) {
    [lab] = await db
      .insert(labs)
      .values({ slug: "default", name: "Default Lab" })
      .returning();
  }

  for (const user of allUsers) {
    const [existing] = await db
      .select()
      .from(labMembers)
      .where(eq(labMembers.userId, user.id as any))
      .limit(1);

    if (existing) {
      console.log(`User ${user.id} already in lab`);
    } else {
      const [member] = await db
        .insert(labMembers)
        .values({
          labId: lab.id,
          userId: user.id as any,
          role: "researcher"
        })
        .returning();
      console.log(`Assigned user ${user.id} to lab`);
    }
  }
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
