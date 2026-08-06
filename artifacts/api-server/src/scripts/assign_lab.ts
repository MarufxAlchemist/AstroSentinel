import { db, labs, labMembers, users } from "@workspace/db";
import { eq } from "drizzle-orm";

async function run() {
  const [user] = await db.select().from(users).limit(1);
  if (!user) {
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

  const [existing] = await db
    .select()
    .from(labMembers)
    .where(eq(labMembers.userId, user.id as any))
    .limit(1);

  if (existing) {
    console.log("User already belongs to a lab:", existing);
  } else {
    const [member] = await db
      .insert(labMembers)
      .values({
        labId: lab.id,
        userId: user.id as any,
        role: "admin"
      })
      .returning();
    console.log("Assigned user to lab successfully:", member);
  }
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
