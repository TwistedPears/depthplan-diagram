# Rails source audit

Read the lockfile and application defaults for the Rails version. Inspect routes,
autoload/zeitwerk configuration, inflections/acronyms, namespace/table prefixes and
engine mounts/isolation. Use the corresponding version's official Rails guides;
do not boot an untrusted app or run migrations to discover conventions.

Follow a resource declaration through its controller/actions and evidenced model,
view/partial or serializer. Imports are not required for an autoloaded reference.
Check actual files and configured naming before resolving a constant. Keep duplicate
names in separate namespaces/engines distinct. Record unresolved `constantize`,
generated methods, conditional loads or other metaprogramming as unknown.

Inspect concerns, validations, callbacks, jobs, mailers and channels where present.
Map service/policy/presenter layers only when the repository actually uses them.
Trace authorization at the observed boundary, including gaps; never infer it from
a controller's name. Follow asynchronous arguments and the job implementation.

For associations, read options and schema together: class/table/foreign-key
overrides, join models, `through`, polymorphic declarations, STI inheritance and
custom inheritance columns. A `belongs_to` is not proof of a database constraint.
A polymorphic type/id pair is not one fixed foreign key or an exhaustive target
list. An STI subclass shares storage when source establishes that behavior; do not
invent another table. Record supported related spellings for later literal search.

The bundled fixture uses Rails 8.0 declarations and static inspection, checked
against these official references (not a Rails runtime compatibility claim):

- [Autoloading and inflections](https://guides.rubyonrails.org/v8.0/autoloading_and_reloading_constants.html)
- [Routing](https://guides.rubyonrails.org/v8.0/routing.html)
- [Associations, polymorphism and STI](https://guides.rubyonrails.org/v8.0/association_basics.html)
- [Active Record naming](https://guides.rubyonrails.org/v8.0/active_record_basics.html)
