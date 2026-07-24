import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  // Pass cookies through to the response so the session can be refreshed.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Write refreshed cookies onto the outgoing response.
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getUser() validates the JWT with Supabase — never trusts a stale cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const callbackUrl = encodeURIComponent(request.nextUrl.pathname);
    return NextResponse.redirect(
      new URL(`/login?callbackUrl=${callbackUrl}`, request.url)
    );
  }

  return response;
}

// Protect /navigator, /profile/setup, and /settings — everything else
// (including /knowledge-graph) is public.
export const config = {
  matcher: [
    "/navigator",
    "/navigator/:path*",
    "/profile/setup",
    "/profile/:path*",
    "/settings",
    "/settings/:path*",
  ],
};
