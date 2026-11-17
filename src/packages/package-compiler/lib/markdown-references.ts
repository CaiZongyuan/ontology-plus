import path from 'node:path';
import { fromMarkdown } from 'mdast-util-from-markdown';
import type { DevelopmentPackageFile } from '../../workspace-store/index.js';

interface MarkdownNode {
  type: string;
  url?: string;
  children?: MarkdownNode[];
  position?: { start: { line: number; column: number } };
}

interface PackageReferenceDiagnostic {
  code: 'UNSAFE_PACKAGE_REFERENCE' | 'UNRESOLVED_PACKAGE_REFERENCE';
  path: string;
  target: string;
  message: string;
}

/** Validate references against delivered files only; never read or fetch link targets. */
export function validatePackageMarkdownReferences(
  files: readonly Pick<DevelopmentPackageFile, 'relativePath' | 'content'>[],
): PackageReferenceDiagnostic[] {
  const deliveredPaths = new Set(files.map((file) => file.relativePath));
  const diagnostics: PackageReferenceDiagnostic[] = [];

  function check(source: string, node: MarkdownNode): void {
    const target = node.url!;
    const fail = (code: PackageReferenceDiagnostic['code'], reason: string) => {
      const location = node.position ? ` at line ${node.position.start.line}, column ${node.position.start.column}` : '';
      diagnostics.push({
        code,
        path: source,
        target,
        message: `Reference ${JSON.stringify(target)}${location}: ${reason} Update this source to reference a delivered package file or an external URL.`,
      });
    };

    // These references are self-contained or explicitly external, rather than package paths.
    const scheme = /^[a-z][a-z0-9+.-]*:/i.exec(target)?.[0].toLowerCase();
    if (scheme) {
      if (!['http:', 'https:', 'ftp:', 'mailto:', 'tel:', 'data:'].includes(scheme)) {
        fail('UNSAFE_PACKAGE_REFERENCE', 'The URL protocol is unsupported for an exported package.');
      }
      return;
    }
    if (target.startsWith('//')) return;
    const encodedPath = target.split(/[?#]/, 1)[0];
    if (!encodedPath) return; // Same-document fragments and query strings.

    let localPath: string;
    try { localPath = decodeURIComponent(encodedPath); }
    catch {
      fail('UNSAFE_PACKAGE_REFERENCE', 'The local path has invalid percent encoding.');
      return;
    }
    if (/^[\/\\]|[\\:\u0000-\u001f\u007f]/.test(localPath)) {
      fail('UNSAFE_PACKAGE_REFERENCE', 'Use a relative package path with forward slashes, without absolute paths or control characters.');
      return;
    }
    const resolvedPath = path.posix.normalize(path.posix.join(path.posix.dirname(source), localPath));
    if (resolvedPath === '..' || resolvedPath.startsWith('../')) {
      fail('UNSAFE_PACKAGE_REFERENCE', 'The local path escapes the package root.');
    } else if (!deliveredPaths.has(resolvedPath)) {
      fail('UNRESOLVED_PACKAGE_REFERENCE', `The target resolves to ${JSON.stringify(resolvedPath)}, which is absent from the package.`);
    }
  }

  for (const file of files) {
    if (!/\.(?:md|markdown)$/i.test(file.relativePath)) continue;
    const visit = (node: MarkdownNode): void => {
      // Definitions cover reference-style links and images; code nodes have no link children.
      if (['link', 'image', 'definition'].includes(node.type) && node.url !== undefined) check(file.relativePath, node);
      for (const child of node.children ?? []) visit(child);
    };
    visit(fromMarkdown(file.content));
  }
  return diagnostics;
}
