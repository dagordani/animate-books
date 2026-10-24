import type { Book } from "./book";
import alice from "@/public/books/alice/book.json";

export const BOOKS: Record<string, Book> = { alice: alice as Book };
