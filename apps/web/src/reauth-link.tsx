"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

export function ReauthLink({
  className,
  label
}: {
  readonly className?: string;
  readonly label: string;
}): ReactNode {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const returnTo = query.length > 0 ? `${pathname}?${query}` : pathname;
  const href = `/login?${new URLSearchParams({
    reauth: "1",
    returnTo
  }).toString()}`;

  return (
    <Link className={className} href={href}>
      {label}
    </Link>
  );
}
