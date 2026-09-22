import fs from 'fs';
const elf = JSON.parse(fs.readFileSync(process.argv[2] || './elfhosted.json','utf8'));
const mapped = {
  version: 1,
  gdrive: { identsFolder: elf.ident_path || "/ATV Network/Idents", lineupFolder: elf.lineup_path || "/ATV Network/Lineup", clientId: elf.gdrive_client_id || "" },
  torbox: { apiKeyRef: "TORBOX_KEY", enabled: !!elf.torbox_key },
  tmdb: { apiKeyRef: "TMDB_KEY" },
  simkl: { clientId: elf.simkl_client_id || "" },
  player: { profile: "auto", forcedSubsOnly: true },
  channels: (elf.channels || []).map(c => ({ id: c.id, name: c.name, category: c.category || "General", country: "US", genre: c.genres || [], lineup: c.lineup || [] }))
};
fs.mkdirSync('./packages/ui-shared/src', { recursive: true });
fs.writeFileSync('./packages/ui-shared/src/config.example.json', JSON.stringify(mapped, null, 2));
console.log("Mapped ElfHosted -> @atv/ui-shared contracts");
