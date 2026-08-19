            return

        domaine_suspect = _contient_lien_suspect(message.content)
        if domaine_suspect is not None:
            try:
                await message.delete()
            except discord.HTTPException:
                pass
            log_channel = message.guild.get_channel(config.MODERATION_LOG_CHANNEL_ID)
            if log_channel:
                embed_lien = discord.Embed(
                    title="🚫 Message supprimé — lien suspect",
                    color=discord.Color.red(),
                )
                embed_lien.add_field(name="Auteur", value=f"{message.author.mention} ({message.author})", inline=False)
                embed_lien.add_field(name="Salon", value=message.channel.mention, inline=False)
                embed_lien.add_field(name="Domaine détecté", value=domaine_suspect, inline=False)
                embed_lien.add_field(name="Contenu", value=message.content[:1000] or "*(vide)*", inline=False)
                try:
                    await log_channel.send(embed=embed_lien)
                except discord.HTTPException:
                    pass
            try:
                await message.channel.send(
                    f"{message.author.mention} ton message a été supprimé car il contenait un lien suspect "
                    "(potentiel phishing). Merci de ne jamais partager ce type de lien. ⚠️",
                    delete_after=config.MODERATION_WARNING_DELETE_AFTER,
                )
            except discord.HTTPException:
                pass
            return
