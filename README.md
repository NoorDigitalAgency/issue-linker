# Issue Linker

Used for:
- Links the issue with the pull request on ZenHub

Usage:
```yaml
      - uses: NoorDigitalAgency/issue-marker@main
        with:
          token: ${{ secrets.token }} # Token with sufficient privilege
          zenhub-key: ${{ secrets.zenhub-key }} # ZenHub API Key
          zenhub-workspace: ${{ secrets.zenhub-workspace }} # ZenHub Workspace ID
```
