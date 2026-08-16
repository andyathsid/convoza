import { verifyAuthToken } from "@/features/auth/server";

export const GET = verifyAuthToken;
