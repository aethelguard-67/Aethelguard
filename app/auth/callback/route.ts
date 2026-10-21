import { createServerClient, type SetAllCookies } from "@supabase/ssr"
import { NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code")
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!code || !url || !anonKey) {
    return NextResponse.redirect(new URL("/login?auth_error=callback", request.url))
  }

  const response = NextResponse.redirect(new URL("/dashboard", request.url))
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookies: Parameters<SetAllCookies>[0]) {
        cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })

  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.redirect(new URL("/login?auth_error=callback", request.url))
  }

  return response
}
