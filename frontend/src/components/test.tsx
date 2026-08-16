"use client";

import { ArrowDownFromLine } from "lucide-react";
import { useState } from "react";

export function UsernamePreview({ greeting }: { greeting: string }) {
  const [username, setUsername] = useState("");

  function handleChange(val: string) {
    setUsername(val)
  }

  return (
    <label>
      Username
      <input value={username} onChange={(e) => {handleChange(e.target.value)}} />
      <p>{greeting}, {username || "new user"}.</p>
    </label>
  )
}
