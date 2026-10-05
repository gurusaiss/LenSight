import { describe, expect, it } from 'vitest';
import { detectFileKind, extractLocalFile, parseCsv } from '../../src/core/adapters/localFileAdapter';
import { chunkDocument } from '../../src/core/processing/chunk';

function makeFile(name: string, contents: string, type = ''): File {
  return new File([contents], name, { type });
}

describe('localFileAdapter', () => {
  it('detectFileKind maps extensions/mime types correctly', () => {
    expect(detectFileKind({ name: 'notes.txt' })).toBe('txt');
    expect(detectFileKind({ name: 'notes.md' })).toBe('md');
    expect(detectFileKind({ name: 'data.csv' })).toBe('csv');
    expect(detectFileKind({ name: 'data.json' })).toBe('json');
    expect(detectFileKind({ name: 'report.pdf' })).toBe('pdf');
    expect(detectFileKind({ name: 'letter.docx' })).toBe('docx');
    expect(detectFileKind({ name: 'mystery.xyz' })).toBe('unknown');
  });

  it('extracts a .txt file into a paragraph block', async () => {
    const file = makeFile('note.txt', 'Just a plain paragraph of text content here.', 'text/plain');
    const { document, kind, confidence } = await extractLocalFile(file);

    expect(kind).toBe('txt');
    expect(confidence).toBe('high');
    expect(document.text).toContain('Just a plain paragraph');
    expect(document.title).toBe('note.txt');
  });

  it('extracts a .md file into heading + paragraph + list-item blocks', async () => {
    const md = '# Title Heading\n\nA paragraph of body text follows the heading.\n\n- item one\n- item two';
    const file = makeFile('doc.md', md);
    const { document } = await extractLocalFile(file);

    const types = document.blocks!.map((b) => b.type);
    expect(types).toContain('heading');
    expect(types).toContain('paragraph');
    expect(types).toContain('list-item');
    expect(document.blocks!.find((b) => b.type === 'heading')?.text).toBe('Title Heading');
    expect(document.blocks!.filter((b) => b.type === 'list-item').map((b) => b.text)).toEqual([
      'item one',
      'item two',
    ]);
  });

  it('parseCsv handles quoted fields with embedded commas', () => {
    const rows = parseCsv('name,age,note\n"Doe, Jane",30,"Says ""hi"""\nBob,40,plain');
    expect(rows).toEqual([
      ['name', 'age', 'note'],
      ['Doe, Jane', '30', 'Says "hi"'],
      ['Bob', '40', 'plain'],
    ]);
  });

  it('extracts a .csv file into one list-item block per row, columns labeled', async () => {
    const csv = 'name,age\nAlice,30\nBob,40';
    const file = makeFile('people.csv', csv, 'text/csv');
    const { document, kind } = await extractLocalFile(file);

    expect(kind).toBe('csv');
    expect(document.text).toContain('name: Alice, age: 30');
    expect(document.text).toContain('name: Bob, age: 40');
  });

  it('extracts a .json file into flattened path:value list-item blocks', async () => {
    const json = JSON.stringify({ user: { name: 'Alice', tags: ['admin', 'active'] } });
    const file = makeFile('user.json', json, 'application/json');
    const { document, kind } = await extractLocalFile(file);

    expect(kind).toBe('json');
    expect(document.text).toContain('user.name: "Alice"');
    expect(document.text).toContain('user.tags[0]: "admin"');
    expect(document.text).toContain('user.tags[1]: "active"');
  });

  it('falls back to raw text for malformed JSON rather than throwing', async () => {
    const file = makeFile('bad.json', '{ this is not valid json', 'application/json');
    const { document, confidence } = await extractLocalFile(file);
    expect(document.text).toContain('this is not valid json');
    expect(confidence).toBe('medium');
  });

  it('throws a clear "Planned" error for .docx rather than faking extraction', async () => {
    const file = makeFile('letter.docx', 'not a real docx');
    await expect(extractLocalFile(file)).rejects.toThrow(/Planned/);
  });

  it('throws for an unrecognized extension', async () => {
    const file = makeFile('mystery.xyz', 'whatever');
    await expect(extractLocalFile(file)).rejects.toThrow(/Unrecognized file type/);
  });

  it('extracted local text files feed cleanly into the existing chunking pipeline', async () => {
    const file = makeFile(
      'note.md',
      '# Heading\n\nThis is a reasonably long paragraph with enough words in it to be a real chunk of content for testing purposes.',
    );
    const { document } = await extractLocalFile(file);
    const chunks = chunkDocument({ ...document, id: 'doc_1', sourceId: 'src_1' });
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0].text).toContain('reasonably long paragraph');
  });
});
