import { handler, ok } from "@/lib/api";
import { listAllTags } from "@/lib/repo";

export const dynamic = "force-dynamic";

export const GET = handler(async () => ok(listAllTags()));
