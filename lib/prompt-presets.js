// Server and client share these preset IDs. The server builds final prompts;
// never assume a browser-supplied prompt is the official preset.
export const PRESETS = Object.freeze({
  image: [
    {id:'natural',name:'Natural motion',icon:'🌿',description:'Subtle, believable movements',instruction:'Add subtle, natural subject movement and realistic environmental motion. Keep facial proportions stable and prevent flicker.'},
    {id:'cinematic',name:'Cinematic',icon:'🎬',description:'Film-like camera movement',instruction:'Use smooth cinematic camera movement, refined lighting and realistic natural motion. Preserve the subject appearance.'},
    {id:'dreamy',name:'Dreamy',icon:'✨',description:'Soft, atmospheric motion',instruction:'Create gentle atmospheric movement, soft golden-hour lighting, subtle depth and a calm dreamlike mood.'},
    {id:'product',name:'Product shot',icon:'💎',description:'Elegant commercial look',instruction:'Use a slow professional product-camera orbit with crisp details, clean studio lighting, and an uncluttered background.'}
  ],
  video: [
    {id:'preserve',name:'Keep the scene',icon:'🎞️',description:'Improve quality without restyling',instruction:'Preserve the original scene composition and movement. Enhance visual consistency, detail and lighting with minimal stylistic change.'},
    {id:'cinematic',name:'Movie look',icon:'🎥',description:'Drama and lighting',instruction:'Restyle the video with cinematic color grading, dramatic but natural lighting, and clear subject detail while respecting the source action.'},
    {id:'neon',name:'Neon city',icon:'🌃',description:'Night city atmosphere',instruction:'Restyle the environment into a tasteful neon-lit city at night. Keep the main subject and action recognizable.'},
    {id:'vintage',name:'Vintage film',icon:'📼',description:'Classic film texture',instruction:'Apply classic analog film tonality, gentle grain and nostalgic warm highlights while preserving the original motion.'}
  ]
});

export function buildPrompt(mode, presetId, extra = '') {
  if (mode === 'act') return ''; // Act-Two API has no promptText: portrait + video drive it.
  const preset = PRESETS[mode]?.find(p => p.id === presetId);
  if (!preset) throw new Error('Invalid preset');
  if (typeof extra !== 'string' || extra.length > 300) throw new Error('Invalid extra instruction');
  const base = mode === 'image'
    ? 'Animate the uploaded image as a short, coherent video. Maintain a consistent subject, realistic anatomy, smooth transitions, and temporal stability.'
    : 'Use the uploaded video as the source. Respect its primary subject and temporal continuity. Produce a coherent, visually stable edit.';
  const freeform = extra.replace(/\s+/g, ' ').trim();
  return [base, preset.instruction, freeform].filter(Boolean).join(' ').slice(0, 1000);
}
