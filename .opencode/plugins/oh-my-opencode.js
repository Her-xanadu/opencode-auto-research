export default async function LocalOhMyOpenCodePlugin(input) {
  if (process.env.ENABLE_LOCAL_OH_MY_OPENCODE !== "1") {
    return {};
  }

  const pluginModule = await import("/usr/local/lib/node_modules/oh-my-opencode/dist/index.js");
  return pluginModule.default(input);
}
