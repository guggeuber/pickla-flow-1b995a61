export function routeRequiresVerifiedAccount(pathname: string) {
  const progressivePublicRoute = pathname === "/"
    || pathname === "/today"
    || pathname === "/courses"
    || pathname.startsWith("/course/")
    || pathname === "/seriespel"
    || pathname.startsWith("/seriespel/");
  return !progressivePublicRoute;
}
