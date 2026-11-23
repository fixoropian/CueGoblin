import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { File } from 'expo-file-system';

import type { Item } from '@/types';

/**
 * A stand-in for the Storage Access Framework directory the folder picker
 * returns. The file it hands out deliberately rejects `create()`, because that
 * is the failure the phone reported: a `File` built under a `content://`
 * directory cannot create itself, and the directory must create the document.
 */
const fakes = vi.hoisted(() => {
  const state = {
    pickDirectoryAsync: vi.fn(),
    createFile: vi.fn(),
  };

  class FakeFile {
    uri: string;
    name: string;
    contents: string | null = null;
    written = false;

    create = vi.fn(() => {
      throw new Error(
        'FileSystemFile.create cannot create a file under a SAF content:// URI. Use Directory.createFile instead.',
      );
    });

    write = vi.fn(async (content: string | Uint8Array) => {
      this.contents = typeof content === 'string' ? content : new TextDecoder().decode(content);
      this.written = true;
    });

    text = vi.fn(async () => {
      if (this.contents === null) throw new Error('This file has no contents.');
      return this.contents;
    });

    bytes = vi.fn(async () => {
      if (this.contents === null) throw new Error('This file has no contents.');
      return new TextEncoder().encode(this.contents);
    });

    /** `copy` is the call that used to fail on the phone, so it must never run. */
    copy = vi.fn(() => {
      throw new Error(
        'FileSystemFile.create cannot create a file under a SAF content:// URI. Use Directory.createFile instead.',
      );
    });

    delete = vi.fn(() => {
      this.contents = null;
      this.written = false;
    });

    constructor(uri: string, name: string) {
      this.uri = uri;
      this.name = name;
    }

    get exists(): boolean {
      return this.written;
    }

    get size(): number {
      return this.contents?.length ?? 0;
    }
  }

  class FakeDirectory {
    uri: string;
    files: FakeFile[] = [];

    static pickDirectoryAsync = state.pickDirectoryAsync;

    constructor(uri: string) {
      this.uri = uri;
    }

    createFile(name: string, mimeType?: string | null): FakeFile {
      state.createFile(name, mimeType);
      const file = new FakeFile(`${this.uri}/${name}`, name);
      this.files.push(file);
      return file;
    }
  }

  return { state, FakeFile, FakeDirectory };
});

vi.mock('expo-file-system', () => ({
  File: fakes.FakeFile,
  Directory: fakes.FakeDirectory,
}));

const { exportBackup, saveFileToFolder } = await import('@/backup/files');
const { backupFileName, parseBackup } = await import('@/backup/format');

const NOW = 1_800_000_000_000;

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: 'item-1',
    text: 'Buy goblin snacks',
    kind: 'shopping',
    done: false,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

const items = [item(), item({ id: 'item-2', text: 'Water the goblin', kind: 'task' })];

function pickedDirectory(uri = 'content://com.android.providers.downloads.documents/tree/downloads') {
  const directory = new fakes.FakeDirectory(uri);
  fakes.state.pickDirectoryAsync.mockResolvedValue(directory);
  return directory;
}

beforeEach(() => {
  fakes.state.pickDirectoryAsync.mockReset();
  fakes.state.createFile.mockReset();
});

describe('exportBackup: picked SAF directory', () => {
  it('creates the file through the directory and writes the backup envelope', async () => {
    const directory = pickedDirectory();

    const result = await exportBackup(items, NOW);

    expect(result.ok).toBe(true);
    expect(fakes.state.createFile).toHaveBeenCalledWith(backupFileName(NOW), 'application/json');
    expect(directory.files).toHaveLength(1);

    const [file] = directory.files;
    expect(result.ok && result.fileName).toBe(backupFileName(NOW));
    expect(result.ok && result.uri).toBe(file.uri);

    const written = parseBackup(file.contents ?? '');
    expect(written.ok).toBe(true);
    if (written.ok) {
      expect(written.value.items).toEqual(items);
      expect(written.value.exportedAt).toBe(NOW);
    }
  });

  it('never builds the file with File.create, which SAF rejects', async () => {
    const directory = pickedDirectory();

    await exportBackup(items, NOW);

    expect(directory.files[0].create).not.toHaveBeenCalled();
    expect(directory.files[0].write).toHaveBeenCalledTimes(1);
  });

  it('reports the name the storage provider actually used', async () => {
    const directory = pickedDirectory();
    const renamed = `${backupFileName(NOW).replace(/\.json$/, ' (1).json')}`;
    directory.createFile = (name: string, mimeType?: string | null) => {
      fakes.state.createFile(name, mimeType);
      const file = new fakes.FakeFile(`${directory.uri}/${renamed}`, renamed);
      directory.files.push(file);
      return file;
    };

    const result = await exportBackup(items, NOW);

    expect(result.ok).toBe(true);
    expect(result.ok && result.fileName).toBe(renamed);
  });

  it('says nothing was written when the folder cannot create the file', async () => {
    const directory = pickedDirectory();
    directory.createFile = () => {
      throw new Error('No permission to create documents in this folder');
    };

    const result = await exportBackup(items, NOW);

    expect(result).toEqual({
      ok: false,
      canceled: false,
      message:
        'Could not create the backup file in that folder: No permission to create documents in this folder',
    });
  });

  it('treats a cancelled folder pick as a cancellation, not a failure', async () => {
    fakes.state.pickDirectoryAsync.mockRejectedValue(
      new Error('The file picker was cancelled by the user'),
    );

    const result = await exportBackup(items, NOW);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.canceled).toBe(true);
  });
});

const COPY_NAME = 'cuegoblin-safety-2026-11-23-101500.json';
const COPY_TEXT = `${JSON.stringify({ format: 'cuegoblin.safety', version: 1 }, null, 2)}\n`;

/** A safety copy as it sits in the app's private documents directory. */
async function appPrivateFile(name = COPY_NAME, text = COPY_TEXT) {
  const file = new fakes.FakeFile(`file:///documents/cuegoblin-safety/${name}`, name);
  await file.write(text);
  return file as unknown as File;
}

/** Makes the picked directory return a file whose `write` fails. */
function directoryWithFailingWrite(directory: InstanceType<typeof fakes.FakeDirectory>, message: string) {
  directory.createFile = (name: string, mimeType?: string | null) => {
    fakes.state.createFile(name, mimeType);
    const file = new fakes.FakeFile(`${directory.uri}/${name}`, name);
    file.write = vi.fn(async () => {
      throw new Error(message);
    });
    directory.files.push(file);
    return file;
  };
}

describe('saveFileToFolder: picked SAF directory', () => {
  it('creates the file through the directory and writes the whole copy', async () => {
    const directory = pickedDirectory();
    const source = await appPrivateFile();

    const result = await saveFileToFolder(source);

    expect(result).toEqual({ ok: true, fileName: COPY_NAME });
    expect(fakes.state.createFile).toHaveBeenCalledWith(COPY_NAME, 'application/json');
    expect(directory.files).toHaveLength(1);

    const [file] = directory.files;
    expect(file.contents).toBe(COPY_TEXT);
    expect(file.create).not.toHaveBeenCalled();
    expect(source.copy).not.toHaveBeenCalled();
  });

  it('reports the name the storage provider actually used', async () => {
    const directory = pickedDirectory();
    const renamed = COPY_NAME.replace(/\.json$/, ' (1).json');
    directory.createFile = (name: string, mimeType?: string | null) => {
      fakes.state.createFile(name, mimeType);
      const file = new fakes.FakeFile(`${directory.uri}/${renamed}`, renamed);
      directory.files.push(file);
      return file;
    };

    const result = await saveFileToFolder(await appPrivateFile());

    expect(result).toEqual({ ok: true, fileName: renamed });
    expect(directory.files[0].contents).toBe(COPY_TEXT);
  });

  it('reports a failure when the folder cannot create the file', async () => {
    const directory = pickedDirectory();
    directory.createFile = () => {
      throw new Error('No permission to create documents in this folder');
    };

    const result = await saveFileToFolder(await appPrivateFile());

    expect(result).toEqual({
      ok: false,
      canceled: false,
      message:
        `Could not create ${COPY_NAME} in that folder: No permission to create documents in this folder`,
    });
  });

  it('discards the file when the copy cannot be written', async () => {
    const directory = pickedDirectory();
    directoryWithFailingWrite(directory, 'No space left on device');

    const result = await saveFileToFolder(await appPrivateFile());

    expect(result).toEqual({
      ok: false,
      canceled: false,
      message: `Could not save ${COPY_NAME} to that folder: No space left on device`,
    });
    expect(directory.files[0].delete).toHaveBeenCalledTimes(1);
    expect(directory.files[0].contents).toBeNull();
  });

  it('discards the file when it does not read back as the same bytes', async () => {
    const directory = pickedDirectory();
    directory.createFile = (name: string, mimeType?: string | null) => {
      fakes.state.createFile(name, mimeType);
      const file = new fakes.FakeFile(`${directory.uri}/${name}`, name);
      file.bytes = vi.fn(async () => new TextEncoder().encode('{}'));
      directory.files.push(file);
      return file;
    };

    const result = await saveFileToFolder(await appPrivateFile());

    expect(result).toEqual({
      ok: false,
      canceled: false,
      message: `${COPY_NAME} was written but does not read back as the same contents, so the copy was not confirmed.`,
    });
    expect(directory.files[0].delete).toHaveBeenCalledTimes(1);
  });

  it('treats a cancelled folder pick as a cancellation, not a failure', async () => {
    fakes.state.pickDirectoryAsync.mockRejectedValue(
      new Error('The file picker was cancelled by the user'),
    );

    const result = await saveFileToFolder(await appPrivateFile());

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.canceled).toBe(true);
    expect(fakes.state.createFile).not.toHaveBeenCalled();
  });
});
