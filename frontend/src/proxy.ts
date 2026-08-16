import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  authMiddleware,
  redirectToHome,
  redirectToLogin,
} from "next-firebase-auth-edge";
import { getAuthConfig } from "@/lib/auth-config";

const PUBLIC_PATHS = ["/sign-in", "/sign-up"];

export async function proxy(request: NextRequest) {
  const authConfig = getAuthConfig();

  return authMiddleware(request, {
    loginPath: authConfig.loginPath,
    logoutPath: authConfig.logoutPath,
    apiKey: authConfig.apiKey,
    cookieName: authConfig.cookieName,
    cookieSignatureKeys: authConfig.cookieSignatureKeys,
    cookieSerializeOptions: authConfig.cookieSerializeOptions,
    serviceAccount: authConfig.serviceAccount,
    enableMultipleCookies: true,
    debug: process.env.NODE_ENV === "development",

    handleValidToken: async (_tokens, headers) => {
      // Authenticated users on public pages should be redirected to chat
      if (PUBLIC_PATHS.includes(request.nextUrl.pathname)) {
        return redirectToHome(request, { path: "/chat" });
      }

      return NextResponse.next({ request: { headers } });
    },

    handleInvalidToken: async (reason) => {
      console.info("Missing or malformed auth credentials", { reason });
      return redirectToLogin(request, {
        path: "/sign-in",
        publicPaths: PUBLIC_PATHS,
      });
    },

    handleError: async (error) => {
      console.error("Unhandled auth error", { error });
      return redirectToLogin(request, {
        path: "/sign-in",
        publicPaths: PUBLIC_PATHS,
      });
    },
  });
}

export const config = {
  matcher: [
    "/api/login",
    "/api/logout",
    "/",
    "/sign-in",
    "/sign-up",
    "/chat/:path*",
  ],
};
