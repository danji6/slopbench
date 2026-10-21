export const longDescription = `Catalog tool 120: full original description.

${'Detailed analysis instructions with preserved Unicode: café 漢字.\n'.repeat(8)}
Final evidence retrieval instructions beyond the summary.`

export const catalogDefinitions = Array.from({ length: 250 }, (_, index) => ({
  name: `tool_${String(index).padStart(3, '0')}`,
  description: index === 120 ? longDescription : `Catalog tool ${index}`,
  inputSchema: '{"type":"object"}',
  metadata: '{}',
}))

export const catalogTools = catalogDefinitions.map((definition, index) => ({
  _id: `opaque-${index}`,
  name: definition.name,
  description: definition.description.slice(0, 256),
  descriptionTruncated: definition.description.length > 256,
}))
