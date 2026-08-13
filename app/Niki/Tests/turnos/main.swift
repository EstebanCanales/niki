var fails = 0
func check(_ ok: Bool, _ what: String) {
    print((ok ? "✔ " : "✘ ") + what); if !ok { fails += 1 }
}
// órdenes de parar
check(NikiTurnAssembler.isStopCommand("pará"), "pará → stop")
check(NikiTurnAssembler.isStopCommand("Para."), "Para. → stop")
check(NikiTurnAssembler.isStopCommand("pará, pará, pará"), "repetido → stop")
check(NikiTurnAssembler.isStopCommand("callate"), "callate → stop")
check(!NikiTurnAssembler.isStopCommand("pará de hablar del clima y contame otra cosa"), "orden larga NO es stop")
check(!NikiTurnAssembler.isStopCommand("¿cuál es la capital de Francia?"), "pregunta NO es stop")
// frases a medias
check(NikiTurnAssembler.looksUnfinished("quiero que me digas"), "termina en verbo suelto sin punto")
check(NikiTurnAssembler.looksUnfinished("necesito que busques la dirección de"), "termina en 'de'")
check(NikiTurnAssembler.looksUnfinished("mirá,"), "termina en coma")
check(!NikiTurnAssembler.looksUnfinished("¿Cuál es la capital de Francia?"), "pregunta cerrada")
check(!NikiTurnAssembler.looksUnfinished("Contame algo sobre el mar."), "afirmación cerrada")
// unión
check(NikiTurnAssembler.merge("quiero que me digas", "La capital de Francia.")
      == "quiero que me digas la capital de Francia.", "une y baja la mayúscula")
check(NikiTurnAssembler.merge("mirá,", "¿Qué hora es?") == "mirá ¿Qué hora es?", "quita la coma colgada")
check(NikiTurnAssembler.merge("", "Hola.") == "Hola.", "sin previo")
check(NikiTurnAssembler.merge("hola", "hola qué tal") == "hola qué tal", "no duplica si el STT ya lo trae")
print(fails == 0 ? "\nTODO OK" : "\n\(fails) FALLOS")
check(NikiTurnAssembler.looksUnfinished("poné música"), "sin cierre → a medias (barato equivocarse)")
check(!NikiTurnAssembler.looksUnfinished("Poné música."), "con punto → cerrada")
check(NikiTurnAssembler.isResumeCommand("seguí"), "seguí → retomar")
check(NikiTurnAssembler.isResumeCommand("Dale."), "Dale. → retomar")
check(!NikiTurnAssembler.isResumeCommand("seguí pero contame de otra cosa"), "seguí + tema NO es retomar")
check(NikiTurnAssembler.resumePrompt(interrupted: "El océano nació del vapor").contains("El océano nació del vapor"),
      "el prompt de retomar lleva lo ya dicho")
check(NikiTurnAssembler.resumePrompt(interrupted: "x").contains("sin repetir"), "pide no repetir")

print("\n── polish ──")
check(NikiTurnAssembler.polish("Eh, contame algo del mar") == "Contame algo del mar", "muletilla al principio")
check(NikiTurnAssembler.polish("quiero, o sea, que busques eso") == "Quiero, que busques eso", "muletilla entre comas")
check(NikiTurnAssembler.polish("abrí la la carpeta") == "Abrí la carpeta", "tartamudeo de palabra corta")
check(NikiTurnAssembler.polish("hola  ,  ¿qué tal?") == "Hola, ¿qué tal?", "espacios y puntuación")
check(NikiTurnAssembler.polish("¿Cuál es la capital de Francia?") == "¿Cuál es la capital de Francia?", "una frase limpia no se toca")
// Solo se colapsan palabras de hasta 4 letras. Con palabras largas es más probable
// que la repetición sea énfasis de verdad y no un tartamudeo del STT.
check(NikiTurnAssembler.polish("necesito necesito revisar esto") == "Necesito necesito revisar esto", "palabra larga repetida NO se toca (puede ser énfasis)")
