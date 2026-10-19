import Link from "next/link";
import { FileQuestionIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function ShareNotFound() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center justify-center px-4 py-24 text-center sm:px-6">
      <FileQuestionIcon className="mb-4 size-10 text-muted-foreground" aria-hidden="true" />
      <h1 className="text-2xl font-semibold tracking-tight">This share does not exist</h1>
      <p className="mt-2 text-muted-foreground">
        The link may be mistyped, or the collection may have been deleted.
      </p>
      <Button asChild className="mt-6">
        <Link href="/">Create your own collection</Link>
      </Button>
    </div>
  );
}
