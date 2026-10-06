"use client";

import React, { useEffect, useState } from "react";
import { apiFetch } from "@/lib/mc-server";

interface AuthImageProps {
  src: string;
  alt: string;
  className?: string;
  fallback: React.ReactNode;
}

/** Image served by the worker (needs the auth header, so it's fetched as a blob). */
export function AuthImage({ src, alt, className, fallback }: AuthImageProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let active = true;
    setFailed(false);
    apiFetch(src)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (failed || !url) return <>{fallback}</>;
  return <img src={url} alt={alt} className={className} />;
}
