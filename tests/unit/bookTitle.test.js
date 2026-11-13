const { cleanBookTitle } = require("../../lib/bookTitle");

describe("cleanBookTitle", () => {
    test("drops a MARC subfield and the alternate title after it", () => {
        expect(cleanBookTitle("Peter Pan : $b [Peter and Wendy]")).toBe("Peter Pan");
    });

    test("keeps ordinary titles as they are", () => {
        expect(cleanBookTitle("Pride and Prejudice")).toBe("Pride and Prejudice");
        expect(cleanBookTitle("Frankenstein; Or, The Modern Prometheus")).toBe("Frankenstein; Or, The Modern Prometheus");
        expect(cleanBookTitle("The Strange Case of Dr. Jekyll and Mr. Hyde")).toBe("The Strange Case of Dr. Jekyll and Mr. Hyde");
    });

    test("keeps only the first line (Gutenberg puts the subtitle on the next line)", () => {
        expect(cleanBookTitle("Alice's Adventures in Wonderland\nIllustrated")).toBe("Alice's Adventures in Wonderland");
    });

    test("drops a trailing [alternate title]", () => {
        expect(cleanBookTitle("Peter Pan [Peter and Wendy]")).toBe("Peter Pan");
    });

    test("empty or missing -> Untitled", () => {
        expect(cleanBookTitle("")).toBe("Untitled");
        expect(cleanBookTitle(null)).toBe("Untitled");
        expect(cleanBookTitle(undefined)).toBe("Untitled");
    });
});
