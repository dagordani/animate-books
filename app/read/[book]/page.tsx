import { notFound } from "next/navigation";
import { Player } from "@/components/Player";
import { BOOKS } from "@/lib/books";

export function generateStaticParams() {
  return Object.keys(BOOKS).map((book) => ({ book }));
}

export default async function ReadPage({ params }: { params: Promise<{ book: string }> }) {
  const { book: id } = await params;
  const book = BOOKS[id];
  if (!book) notFound();
  return <Player book={book} />;
}
