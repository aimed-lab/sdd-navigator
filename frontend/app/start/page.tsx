// /start used to be a welcome page. Old links go to Collaborate, where teams,
// communities and service providers are.

import { redirect } from "next/navigation";

export default function StartPage() {
  redirect("/collaborate");
}
