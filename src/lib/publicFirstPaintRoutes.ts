export function routeRequiresVerifiedAccount(pathname: string) {
  const progressivePublicRoute = pathname === "/"
    || pathname === "/today"
    || pathname === "/courses"
    || pathname.startsWith("/course/")
    || pathname === "/seriespel"
    || pathname.startsWith("/seriespel/")
    || pathname.startsWith("/p/")
    || pathname.startsWith("/program/");
  return !progressivePublicRoute;
}
