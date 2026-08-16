import { type NextRequest, NextResponse } from "next/server";

const backendApiUrl =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";

export async function verifyAuthToken(request: NextRequest) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const response = await fetch(`${backendApiUrl}/auth/verify`, {
    headers: { Authorization: authHeader },
  });

  if (!response.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(await response.json());
}
