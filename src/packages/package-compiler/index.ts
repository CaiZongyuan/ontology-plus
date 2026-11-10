export {
  compileDevelopmentPackage,
  compileOntologySkill,
  type CompiledPackageFile,
  type CompiledDevelopmentPackage,
} from './lib/compiler.js';

export {
  inspectOntologyMcpCapabilities,
  handleOntologyMcpRequest,
  type McpToolDefinition,
  type McpResourceDefinition,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './lib/mcp-server.js';

