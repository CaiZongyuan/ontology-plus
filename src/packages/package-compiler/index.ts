export {
  buildOntologySuiteManifest,
  compileDevelopmentPackage,
  compileOntologySkill,
  type CompileDevelopmentPackageInput,
  type CompiledPackageFile,
  type CompiledDevelopmentPackage,
} from './lib/compiler.js';

export {
  buildZipArchive,
  compileDevelopmentPackageZip,
  type ZipArchiveEntryInput,
  type CompiledDevelopmentPackageZip,
} from './lib/zip-builder.js';

export {
  toSafeMcpToolName,
  inspectOntologyMcpCapabilities,
  buildMcpClientConfigJson,
  handleOntologyMcpRequest,
  type McpToolDefinition,
  type McpResourceDefinition,
  type McpHandlerOptions,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './lib/mcp-server.js';
